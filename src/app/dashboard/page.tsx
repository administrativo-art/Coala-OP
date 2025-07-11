
"use client"

import { useMemo, useState, useEffect } from "react"
import Link from "next/link"
import { useAuth } from "@/hooks/use-auth"
import { useExpiryProducts } from "@/hooks/use-expiry-products"
import { useProducts } from "@/hooks/use-products"
import { useConsumptionAnalysis } from "@/hooks/use-consumption-analysis"
import { useKiosks } from "@/hooks/use-kiosks"
import { useReturnRequests } from "@/hooks/use-return-requests"
import { useMonthlySchedule } from "@/hooks/use-monthly-schedule"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Box, Package, AlertTriangle, TrendingUp, ListFilter, Truck, Users, Download } from 'lucide-react'
import { differenceInDays, parseISO } from 'date-fns'
import { format } from "date-fns"
import { ptBR } from 'date-fns/locale'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell } from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { type ReturnRequest, returnRequestStatuses } from "@/types"
import { cn } from "@/lib/utils"
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import Papa from 'papaparse';


export default function DashboardPage() {
  const { user, permissions } = useAuth()
  const { lots, loading: lotsLoading } = useExpiryProducts()
  const { products, loading: productsLoading } = useProducts()
  const { history: consumptionHistory, loading: consumptionLoading } = useConsumptionAnalysis()
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { requests: returnRequests, loading: returnRequestsLoading } = useReturnRequests();
  const { schedule, loading: scheduleLoading } = useMonthlySchedule();

  const [selectedKiosk, setSelectedKiosk] = useState<string>('matriz');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [initialSelectionMade, setInitialSelectionMade] = useState(false);

  const activeProducts = useMemo(() => products.filter(p => !p.isArchived), [products]);
  
  const CHART_COLORS = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
  ];

  useEffect(() => {
    // Set initial selection only once when active products are loaded.
    if (!initialSelectionMade && activeProducts.length > 0) {
      setSelectedProducts(activeProducts.map(p => p.id));
      setInitialSelectionMade(true);
    }
  }, [activeProducts, initialSelectionMade]);

  const lotsInKiosk = useMemo(() => {
    if (lotsLoading || !user) return [];
    if (user.username === 'Tiago Brasil') return lots;
    return lots.filter(lot => user.assignedKioskIds.includes(lot.kioskId));
  }, [lots, user, lotsLoading]);

  const expiringSoonLots = useMemo(() => {
    if (lotsLoading) return [];
    return lotsInKiosk.filter(lot => {
        const days = differenceInDays(parseISO(lot.expiryDate), new Date());
        return days >= 0 && days <= 7 && lot.quantity > 0;
    }).sort((a,b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  }, [lotsInKiosk, lotsLoading]);

  const expiringSoonCount = useMemo(() => {
    return expiringSoonLots.length;
  }, [expiringSoonLots]);

  const expiredCount = useMemo(() => {
     if (lotsLoading) return 0;
    return lotsInKiosk.filter(lot => differenceInDays(parseISO(lot.expiryDate), new Date()) < 0 && lot.quantity > 0).length;
  }, [lotsInKiosk, lotsLoading]);
  
  const myActiveReturnRequests = useMemo(() => {
    if (returnRequestsLoading || !user) return [];
    
    const activeRequests = returnRequests.filter(r => !r.isArchived);

    if (user.username === 'Tiago Brasil' || permissions.returns.updateStatus) { 
        return activeRequests;
    }

    return activeRequests.filter(r => r.createdBy.userId === user.id);
  }, [returnRequests, returnRequestsLoading, user, permissions]);

  const chartData = useMemo(() => {
    const loading = consumptionLoading || productsLoading || kiosksLoading;
    if (loading || !user || consumptionHistory.length === 0 || products.length === 0) {
      return [];
    }

    const kioskConsumption: { [kioskId: string]: { [productId: string]: { total: number; count: number } } } = {};

    consumptionHistory.forEach(report => {
      if (!kioskConsumption[report.kioskId]) {
        kioskConsumption[report.kioskId] = {};
      }
      report.results.forEach(item => {
        if (!kioskConsumption[report.kioskId][item.productId]) {
          kioskConsumption[report.kioskId][item.productId] = { total: 0, count: 0 };
        }
        kioskConsumption[report.kioskId][item.productId].total += item.consumedQuantity;
        kioskConsumption[report.kioskId][item.productId].count += 1;
      });
    });

    const kioskIdForChart = user.username === 'Tiago Brasil' ? selectedKiosk : (user.assignedKioskIds[0] || '');
    let relevantConsumptionData: { [productId: string]: number } = {};

    if (kioskIdForChart === 'matriz' && user.username === 'Tiago Brasil') {
        const masterAverages: { [productId: string]: { totalAvg: number } } = {};
        
        Object.entries(kioskConsumption).forEach(([kioskId, productMap]) => {
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

    const dataForChart = activeProducts
      .filter(p => selectedProducts.includes(p.id))
      .map(product => {
        const avgQuantity = relevantConsumptionData[product.id] || 0;
        return {
          productId: product.id,
          name: `${product.baseName} (${product.unit})`,
          "Consumo": parseFloat(avgQuantity.toFixed(2)),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return dataForChart;

  }, [user, consumptionHistory, products, consumptionLoading, productsLoading, kiosks, kiosksLoading, selectedKiosk, selectedProducts, activeProducts]);

  const todayISO = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const todaySchedule = useMemo(() => schedule.find(s => s.id === todayISO), [schedule, todayISO]);
  const kiosksToDisplay = useMemo(() => kiosks.filter(k => k.id !== 'matriz'), [kiosks]);

  const initialLoading = productsLoading || lotsLoading || kiosksLoading || returnRequestsLoading || scheduleLoading;
  const chartHeight = Math.max(350, chartData.length * 40);

  const handleExportPdf = () => {
    if (chartData.length === 0) return;

    const doc = new jsPDF();
    const kioskName = selectedKiosk === 'matriz' ? 'Todos os Quiosques (soma)' : kiosks.find(k => k.id === selectedKiosk)?.name || 'Quiosque Desconhecido';
    const monthYear = format(new Date(), 'MMMM yyyy', { locale: ptBR });
    
    doc.setFontSize(18);
    doc.text(`Relatório de Consumo Médio Mensal`, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Quiosque: ${kioskName}`, 14, 29);
    doc.text(`Gerado em: ${monthYear}`, 14, 35);

    const tableHead = [['Produto (unidade)', 'Consumo Médio']];
    const tableBody = chartData.map(item => [
        item.name,
        item.Consumo.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    ]);

    autoTable(doc, {
        startY: 45,
        head: tableHead,
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: '#3F51B5' },
    });
    
    doc.save(`consumo_medio_${kioskName.replace(/\s/g, '_')}_${format(new Date(), 'MM-yyyy')}.pdf`);
  };

  const handleExportCsv = () => {
    if (chartData.length === 0) return;

    const kioskName = selectedKiosk === 'matriz' ? 'Todos_os_Quiosques' : kiosks.find(k => k.id === selectedKiosk)?.name?.replace(/\s/g, '_') || 'Quiosque_Desconhecido';
    const monthYear = format(new Date(), 'MM-yyyy');
    
    const csvData = chartData.map(item => ({
        "Produto (unidade)": item.name,
        "Consumo Medio": item.Consumo,
    }));
    
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `consumo_medio_${kioskName}_${monthYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportJson = () => {
    if (chartData.length === 0) return;

    const kioskName = selectedKiosk === 'matriz' ? 'Todos os Quiosques (soma)' : kiosks.find(k => k.id === selectedKiosk)?.name || 'Quiosque Desconhecido';
    const monthYear = format(new Date(), 'MM-yyyy');
    
    const exportData = {
      kiosk: kioskName,
      month: monthYear,
      generated_at: new Date().toISOString(),
      data: chartData.map(item => ({
        product_name: item.name,
        average_consumption: item.Consumo,
        product_id: item.productId,
      }))
    };

    const jsonData = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const filenameKiosk = selectedKiosk === 'matriz' ? 'Todos_os_Quiosques' : kiosks.find(k => k.id === selectedKiosk)?.name?.replace(/\s/g, '_') || 'Quiosque_Desconhecido';
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `consumo_medio_${filenameKiosk}_${monthYear}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (initialLoading) {
    return (
        <div>
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-5 w-96 mb-6" />
            <div className="grid gap-4 md:grid-cols-2">
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
      <div className="grid gap-4 md:grid-cols-2">
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

        {expiringSoonLots.length > 0 && (
          <div className="mt-6">
              <Card>
                  <CardHeader>
                      <CardTitle>Insumos Vencendo em Breve</CardTitle>
                      <CardDescription>
                          Estes são os insumos que vencerão nos próximos 7 dias.
                      </CardDescription>
                  </CardHeader>
                  <CardContent>
                      <ScrollArea className="h-48">
                        <div className="space-y-2 pr-4">
                            {expiringSoonLots.map(lot => (
                                <Link href="/dashboard/stock/inventory-control" key={lot.id}>
                                <div className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                                    <div>
                                        <p className="font-semibold">{lot.productName}</p>
                                        <p className="text-sm text-muted-foreground">
                                            Lote: {lot.lotNumber} | Quiosque: {kiosks.find(k => k.id === lot.kioskId)?.name || 'N/A'}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                      <p className="font-bold text-lg">{lot.quantity} un.</p>
                                      <p className="text-xs text-muted-foreground">
                                        Vence em: {format(parseISO(lot.expiryDate), "dd/MM/yyyy")}
                                      </p>
                                    </div>
                                </div>
                                </Link>
                            ))}
                        </div>
                      </ScrollArea>
                  </CardContent>
              </Card>
          </div>
      )}

       <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-1">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="h-6 w-6" /> Escala de Hoje - {format(new Date(), "dd 'de' MMMM", { locale: ptBR })}
                    </CardTitle>
                    <CardDescription>
                        Resumo da escala de trabalho para o dia atual.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {scheduleLoading ? (
                        <div className="grid gap-4 md:grid-cols-2">
                            <Skeleton className="h-24 w-full" />
                            <Skeleton className="h-24 w-full" />
                        </div>
                    ) : todaySchedule ? (
                        <div className="grid gap-4 md:grid-cols-2">
                            {kiosksToDisplay.map(kiosk => {
                                const t1 = todaySchedule[`${kiosk.name} T1`];
                                const t2 = todaySchedule[`${kiosk.name} T2`];
                                const t3 = todaySchedule[`${kiosk.name} T3`];
                                const folga = todaySchedule[`${kiosk.name} Folga`];
                                const isSunday = todaySchedule.diaDaSemana.toLowerCase().includes('domingo');
                                
                                if (!t1 && !t2 && !t3 && !folga) {
                                    return (
                                        <div key={kiosk.id} className="p-3 border rounded-lg bg-muted/50">
                                            <h4 className="font-semibold">{kiosk.name}</h4>
                                            <p className="text-sm mt-2 text-muted-foreground">Sem escala para hoje.</p>
                                        </div>
                                    )
                                }
                                
                                return (
                                    <div key={kiosk.id} className="p-3 border rounded-lg bg-muted/50">
                                        <h4 className="font-semibold">{kiosk.name}</h4>
                                        <div className="text-sm mt-2 space-y-1">
                                            {isSunday ? (
                                                t1 && <p><strong>Turno Único:</strong> {t1}</p>
                                            ) : (
                                                <>
                                                    {t1 && <p><strong>T1:</strong> {t1}</p>}
                                                    {t2 && <p><strong>T2:</strong> {t2}</p>}
                                                    {t3 && <p><strong>T3:</strong> {t3}</p>}
                                                </>
                                            )}
                                            {folga && <p className="text-muted-foreground"><strong>Folga:</strong> {folga}</p>}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center text-muted-foreground text-center py-4">
                            <Users className="h-10 w-10 mb-2" />
                            <p className="font-semibold">Nenhuma escala encontrada para hoje.</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {myActiveReturnRequests.length > 0 && (
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Truck className="h-6 w-6" /> Chamados de Devolução/Bonificação Abertos
                        </CardTitle>
                        <CardDescription>
                            Estes são os seus chamados que precisam de atenção. Clique em um chamado para ver os detalhes.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {myActiveReturnRequests.map(req => {
                                const statusInfo = returnRequestStatuses[req.status];
                                let isOverdue = false;
                                if (req.status === 'em_andamento' && req.dataPrevisaoRetorno) {
                                    isOverdue = differenceInDays(new Date(), parseISO(req.dataPrevisaoRetorno)) > 0;
                                }
                                return (
                                    <Link href="/dashboard/stock/returns" key={req.id}>
                                        <div className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/50 transition-colors">
                                            <div>
                                                <p className="font-semibold">{req.numero}: <span className="font-normal">{req.insumoNome}</span></p>
                                                <p className="text-sm text-muted-foreground">
                                                    Previsão de Conclusão: {format(parseISO(req.dataPrevisaoRetorno), "dd/MM/yyyy", { locale: ptBR })}
                                                </p>
                                            </div>
                                            {statusInfo && (
                                                <Badge className={cn("text-white shrink-0", isOverdue ? 'bg-red-700' : statusInfo.color)}>
                                                    {isOverdue ? `${statusInfo.label} | Atrasado` : statusInfo.label}
                                                </Badge>
                                            )}
                                        </div>
                                    </Link>
                                )
                            })}
                        </div>
                    </CardContent>
                </Card>
            )}
          <Card>
            <CardHeader className="flex flex-col gap-4">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="h-6 w-6" /> Consumo Médio Mensal
                    </CardTitle>
                    <CardDescription>
                        {user?.username === 'Tiago Brasil' 
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
                                <DropdownMenuItem onSelect={() => setSelectedProducts(activeProducts.map(p => p.id))}>Selecionar Todos</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setSelectedProducts([])}>Limpar Seleção</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <ScrollArea className="h-60">
                            {activeProducts.sort((a,b) => a.baseName.localeCompare(b.baseName)).map(product => (
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

                    {user?.username === 'Tiago Brasil' && (
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
            <CardContent className="pr-2 pl-0">
                 { (consumptionLoading || productsLoading || kiosksLoading) ? (
                    <Skeleton className="h-[350px] w-full" />
                    ) : chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={chartHeight}>
                        <BarChart
                            layout="vertical"
                            data={chartData}
                            margin={{
                                top: 5,
                                right: 50,
                                left: 20,
                                bottom: 5,
                            }}
                        >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" allowDecimals={false} />
                            <YAxis
                                type="category"
                                dataKey="name"
                                width={150}
                                tick={{ fontSize: 12 }}
                                interval={0}
                            />
                            <Tooltip 
                                cursor={{fill: 'hsl(var(--muted))'}}
                                contentStyle={{ 
                                    backgroundColor: "hsl(var(--background))", 
                                    border: "1px solid hsl(var(--border))",
                                    borderRadius: "var(--radius)"
                                }}
                            />
                            <Bar dataKey="Consumo" radius={[0, 4, 4, 0]}>
                                {chartData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                ))}
                                <LabelList dataKey="Consumo" position="right" offset={10} style={{ fill: 'hsl(var(--foreground))', fontSize: 12 }} />
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
                                : user?.username === 'Tiago Brasil' && selectedKiosk !== 'matriz' 
                                    ? "Nenhum relatório de consumo encontrado para o quiosque selecionado."
                                    : "Faça o upload de relatórios de consumo para gerar o gráfico."
                                }
                            </p>
                    </div>
                    )}
            </CardContent>
            <CardFooter className="pt-4 border-t justify-end">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" disabled={chartData.length === 0}>
                            <Download className="mr-2 h-4 w-4" />
                            Exportar Relatório
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem onSelect={handleExportPdf}>Exportar como PDF</DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleExportCsv}>Exportar como CSV</DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleExportJson}>Exportar como JSON</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardFooter>
          </Card>
       </div>
    </div>
  )
}
