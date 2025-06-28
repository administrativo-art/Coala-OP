
"use client"

import { useMemo, useState, useEffect } from "react"
import { useAuth } from "@/hooks/use-auth"
import { useExpiryProducts } from "@/hooks/use-expiry-products"
import { useProducts } from "@/hooks/use-products"
import { useConsumptionAnalysis } from "@/hooks/use-consumption-analysis"
import { useStockAnalysisProducts } from "@/hooks/use-stock-analysis-products"
import { useKiosks } from "@/hooks/use-kiosks"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Box, Package, AlertTriangle, TrendingUp, ListFilter } from 'lucide-react'
import { differenceInDays, parseISO } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"


export default function DashboardPage() {
  const { user } = useAuth()
  const { lots, loading: lotsLoading } = useExpiryProducts()
  const { products, loading: productsLoading } = useProducts()
  const { history: consumptionHistory, loading: consumptionLoading } = useConsumptionAnalysis()
  const { products: stockProducts, loading: stockProductsLoading } = useStockAnalysisProducts()
  const { kiosks, loading: kiosksLoading } = useKiosks();

  const [selectedKiosk, setSelectedKiosk] = useState<string>('matriz');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [initialSelectionMade, setInitialSelectionMade] = useState(false);

  useEffect(() => {
    // Set initial selection only once when products are loaded.
    if (!initialSelectionMade && stockProducts.length > 0) {
      setSelectedProducts(stockProducts.map(p => p.id));
      setInitialSelectionMade(true);
    }
  }, [stockProducts, initialSelectionMade]);

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
    const loading = consumptionLoading || stockProductsLoading || kiosksLoading;
    if (loading || !user || consumptionHistory.length === 0 || stockProducts.length === 0) {
      return [];
    }

    // Step 1: Aggregate consumption data (total packages and number of reports)
    const kioskConsumption: { [kioskId: string]: { [productId: string]: { total: number; count: number } } } = {};

    consumptionHistory.forEach(report => {
      if (!kioskConsumption[report.kioskId]) {
        kioskConsumption[report.kioskId] = {};
      }
      report.results.forEach(item => {
        if (!kioskConsumption[report.kioskId][item.productId]) {
          kioskConsumption[report.kioskId][item.productId] = { total: 0, count: 0 };
        }
        kioskConsumption[report.kioskId][item.productId].total += item.consumedPackages;
        kioskConsumption[report.kioskId][item.productId].count += 1;
      });
    });

    // Step 2: Determine which consumption data to use based on selectors
    const kioskIdForChart = user.username === 'master' ? selectedKiosk : user.kioskId;
    let relevantConsumptionData: { [productId: string]: number } = {}; // Stores average packages per product

    if (kioskIdForChart === 'matriz' && user.username === 'master') {
        const masterAverages: { [productId: string]: { totalAvg: number } } = {};
        
        Object.entries(kioskConsumption).forEach(([kioskId, productMap]) => {
            // Aggregate all kiosks except the distribution center itself
            if (kioskId === 'matriz') return;

            Object.entries(productMap).forEach(([productId, data]) => {
                const avgForKiosk = data.count > 0 ? data.total / data.count : 0;
                if (!masterAverages[productId]) {
                    masterAverages[productId] = { totalAvg: 0 };
                }
                masterAverages[productId].totalAvg += avgForKiosk;
            });
        });

        Object.entries(masterAverages).forEach(([productId, data]) => {
            relevantConsumptionData[productId] = data.totalAvg;
        });

    } else {
        const singleKioskData = kioskConsumption[kioskIdForChart];
        if (singleKioskData) {
            Object.entries(singleKioskData).forEach(([productId, data]) => {
                relevantConsumptionData[productId] = data.count > 0 ? data.total / data.count : 0;
            });
        }
    }

    // Step 3: Generate chart data for ALL selected products, maintaining a consistent alphabetical order.
    const dataForChart = stockProducts
      .filter(p => selectedProducts.includes(p.id))
      .map(product => {
        const avgPackages = relevantConsumptionData[product.id] || 0;
        let consumption = Math.ceil(avgPackages);
        let unitLabel = 'Pacotes';

        if (product.hasPurchaseUnit && product.itemsPerPurchaseUnit && product.itemsPerPurchaseUnit > 0) {
            consumption = Math.ceil(avgPackages / product.itemsPerPurchaseUnit);
            unitLabel = product.purchaseUnitName || 'Un. Compra';
        }

        return {
          productId: product.id,
          name: `${product.baseName} (${unitLabel})`,
          "Consumo": consumption,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return dataForChart;

  }, [user, consumptionHistory, stockProducts, consumptionLoading, stockProductsLoading, kiosks, kiosksLoading, selectedKiosk, selectedProducts]);


  const initialLoading = productsLoading || lotsLoading || kiosksLoading;

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

  const handleProductSelection = (productId: string, checked: boolean) => {
    setSelectedProducts(current => {
        if (checked) {
            return [...current, productId];
        } else {
            return current.filter(id => id !== productId);
        }
    });
  }

  const sortedKiosks = kiosks.sort((a,b) => {
    if (a.id === 'matriz') return -1;
    if (b.id === 'matriz') return 1;
    return a.name.localeCompare(b.name);
  });

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
            <CardHeader className="flex flex-col gap-4">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="h-6 w-6" /> Consumo Médio Mensal
                    </CardTitle>
                    <CardDescription>
                        {user?.username === 'master' 
                            ? (selectedKiosk === 'matriz' ? 'Soma do consumo médio mensal de todos os quiosques.' : `Produtos consumidos no quiosque selecionado.`)
                            : `Produtos consumidos no seu quiosque.`}
                    </CardDescription>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:justify-end">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="w-full sm:w-auto">
                                <ListFilter className="mr-2 h-4 w-4" />
                                Filtrar Produtos ({selectedProducts.length})
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-64">
                            <DropdownMenuLabel>Exibir Produtos</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => setSelectedProducts(stockProducts.map(p => p.id))}>Selecionar Todos</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setSelectedProducts([])}>Limpar Seleção</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <ScrollArea className="h-60">
                            {stockProducts.sort((a,b) => a.baseName.localeCompare(b.baseName)).map(product => (
                                <DropdownMenuCheckboxItem
                                    key={product.id}
                                    checked={selectedProducts.includes(product.id)}
                                    onCheckedChange={(checked) => handleProductSelection(product.id, !!checked)}
                                    onSelect={(e) => e.preventDefault()}
                                >
                                    {product.baseName}
                                </DropdownMenuCheckboxItem>
                            ))}
                            </ScrollArea>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {user?.username === 'master' && (
                        <Select value={selectedKiosk} onValueChange={setSelectedKiosk} disabled={kiosksLoading}>
                            <SelectTrigger className="w-full sm:w-[240px]">
                                <SelectValue placeholder="Selecionar Quiosque" />
                            </SelectTrigger>
                            <SelectContent>
                                {sortedKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )}
                </div>
            </CardHeader>
            <CardContent className="pl-2">
                 { (consumptionLoading || stockProductsLoading || kiosksLoading) ? (
                    <Skeleton className="h-[350px] w-full" />
                    ) : chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 70 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} interval={0} angle={-45} textAnchor="end" />
                        <YAxis fontSize={12} tickLine={false} axisLine={false} allowDecimals={false}/>
                        <Tooltip 
                            cursor={{fill: 'hsl(var(--muted))'}}
                            contentStyle={{ 
                                backgroundColor: "hsl(var(--background))", 
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "var(--radius)"
                            }}
                        />
                        <Bar dataKey="Consumo" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]}>
                            <LabelList dataKey="Consumo" position="top" style={{ fill: 'hsl(var(--foreground))', fontSize: 12 }} />
                        </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                    ) : (
                    <div className="flex h-[350px] flex-col items-center justify-center text-muted-foreground text-center">
                            <TrendingUp className="h-12 w-12 mb-4" />
                            <p className="font-semibold">
                                {selectedProducts.length === 0 ? "Nenhum produto selecionado" : "Sem dados de consumo"}
                            </p>
                            <p className="text-sm">
                                {selectedProducts.length === 0
                                ? "Selecione produtos no filtro para exibi-los no gráfico."
                                : user?.username === 'master' && selectedKiosk !== 'matriz' 
                                    ? "Nenhum relatório de consumo encontrado para o quiosque selecionado."
                                    : "Faça o upload de relatórios de consumo para gerar o gráfico."
                                }
                            </p>
                    </div>
                    )}
            </CardContent>
          </Card>
       </div>
    </div>
  )
}
